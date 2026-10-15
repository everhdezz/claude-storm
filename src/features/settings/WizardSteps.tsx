import { IconCheck } from "@tabler/icons-react";
import classes from "./wizard.module.css";

interface WizardStepsProps {
  labels: string[];
  active: number;
}

/** Compact horizontal step indicator: dots joined by a line, labels underneath. */
export function WizardSteps({ labels, active }: WizardStepsProps) {
  return (
    <div className={classes.steps} style={{ gridTemplateColumns: `repeat(${labels.length}, 1fr)` }}>
      {labels.map((label, index) => {
        const state = index < active ? "done" : index === active ? "active" : "todo";
        return (
          <div key={label} className={classes.step} data-state={state}>
            <div className={classes.dot}>{state === "done" ? <IconCheck size={11} stroke={3} /> : index + 1}</div>
            <span className={classes.label}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
