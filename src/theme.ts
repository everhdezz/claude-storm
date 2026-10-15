import { createTheme } from "@mantine/core";

/** Mantine theme shared by every claude-storm window; compact type scale similar to JetBrains IDEs. */
export const theme = createTheme({
  primaryColor: "indigo",
  defaultRadius: "md",
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontFamilyMonospace: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
  fontSizes: {
    xs: "0.6875rem",
    sm: "0.78125rem",
    md: "0.84375rem",
    lg: "0.9375rem",
    xl: "1.0625rem",
  },
  headings: {
    sizes: {
      h1: { fontSize: "1.625rem" },
      h2: { fontSize: "1.375rem" },
      h3: { fontSize: "1.125rem" },
      h4: { fontSize: "1rem" },
      h5: { fontSize: "0.875rem" },
      h6: { fontSize: "0.8125rem" },
    },
  },
});
