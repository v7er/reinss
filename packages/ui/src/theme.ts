import { createTheme } from "@mantine/core";

export const reinsTheme = createTheme({
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace: 'ui-monospace, "SF Mono", Menlo, Monaco, monospace',
  primaryColor: "blue",
  primaryShade: { light: 7, dark: 5 },
  defaultRadius: "lg",
  headings: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif',
    fontWeight: "600",
  },
  components: {
    Button: { defaultProps: { radius: "xl" } },
    Paper: { defaultProps: { radius: "lg", withBorder: true } },
    TextInput: { defaultProps: { radius: "md" } },
    Badge: { defaultProps: { radius: "sm" } },
  },
});
