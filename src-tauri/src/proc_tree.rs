//! Spawning children in their own process group (Unix) or Job Object (Windows) so the whole
//! tree can be terminated without leaving zombies behind.

use std::time::Duration;

use tokio::process::{Child, Command};

use crate::error::AppResult;

/// Grace period between the polite and the forced termination.
const GRACE: Duration = Duration::from_millis(2500);

/// Prepares a command so its descendants can later be killed as a unit.
pub fn isolate(cmd: &mut Command) {
    cmd.kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
}

/// Handle able to terminate a spawned process together with all its descendants.
pub struct ProcessTree {
    pid: u32,
    #[cfg(windows)]
    job: windows_job::Job,
}

impl ProcessTree {
    /// Captures the tree handle right after spawning `child`.
    pub fn attach(child: &Child) -> AppResult<Self> {
        let pid = child.id().ok_or_else(|| crate::error::AppError::msg("process exited immediately"))?;
        #[cfg(windows)]
        {
            let job = windows_job::Job::new()?;
            if let Some(handle) = child.raw_handle() {
                job.assign(handle)?;
            }
            return Ok(Self { pid, job });
        }
        #[cfg(unix)]
        Ok(Self { pid })
    }

    /// Process id of the tree root.
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// Asks the tree to stop (SIGTERM / job close) without waiting.
    pub fn terminate(&self) {
        #[cfg(unix)]
        unsafe {
            libc::killpg(self.pid as libc::pid_t, libc::SIGTERM);
        }
        #[cfg(windows)]
        self.job.terminate();
    }

    /// Forcefully kills every process in the tree.
    pub fn kill(&self) {
        #[cfg(unix)]
        unsafe {
            libc::killpg(self.pid as libc::pid_t, libc::SIGKILL);
        }
        #[cfg(windows)]
        self.job.terminate();
    }

    /// Terminates politely, then force-kills whatever is still alive after the grace period.
    pub async fn shutdown(&self) {
        self.terminate();
        tokio::time::sleep(GRACE).await;
        self.kill();
    }
}

#[cfg(windows)]
mod windows_job {
    use std::ffi::c_void;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    use crate::error::{AppError, AppResult};

    /// Owned Job Object configured to kill every member when closed.
    pub struct Job(HANDLE);

    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        /// Creates a job with KILL_ON_JOB_CLOSE so members die with claude-storm.
        pub fn new() -> AppResult<Self> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return Err(AppError::msg("CreateJobObjectW failed"));
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                Ok(Self(handle))
            }
        }

        /// Adds a running process to the job.
        pub fn assign(&self, process: std::os::windows::io::RawHandle) -> AppResult<()> {
            let ok = unsafe { AssignProcessToJobObject(self.0, process as HANDLE) };
            if ok == 0 {
                return Err(AppError::msg("AssignProcessToJobObject failed"));
            }
            Ok(())
        }

        /// Kills every process in the job.
        pub fn terminate(&self) {
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, BufReader};

    /// Returns true while a pid exists and is not a zombie being reaped.
    fn alive(pid: i32) -> bool {
        unsafe { libc::kill(pid, 0) == 0 }
    }

    #[tokio::test]
    async fn shutdown_kills_grandchildren() {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "sleep 60 & echo $!; wait"]).stdout(std::process::Stdio::piped());
        isolate(&mut cmd);
        let mut child = cmd.spawn().unwrap();
        let tree = ProcessTree::attach(&child).unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).await.unwrap();
        let grandchild: i32 = line.trim().parse().unwrap();
        assert!(alive(grandchild));

        tree.shutdown().await;
        child.wait().await.unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(!alive(grandchild), "grandchild {grandchild} survived");
    }
}
