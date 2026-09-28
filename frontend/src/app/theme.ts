import { createTheme } from "@mui/material";

export const theme = createTheme({
  // Mirrored by the CSS tokens in styles/tokens.css (--color-brand, --color-ink,
  // --color-page, --color-surface); change both together.
  palette: {
    primary: { main: "#19735b", dark: "#10553f", light: "#e5f3ec" },
    secondary: { main: "#5f648d" },
    background: { default: "#f7f8fa", paper: "#ffffff" },
    text: { primary: "#192b28", secondary: "#77817f" },
    divider: "#e7ebe9",
  },
  typography: {
    fontFamily: "Inter Variable, sans-serif",
    fontSize: 13,
    button: { textTransform: "none", fontWeight: 600, letterSpacing: "-0.1px" },
    h4: { fontWeight: 650, letterSpacing: "-1.2px" },
    h5: { fontWeight: 650, letterSpacing: "-0.7px" },
    h6: { fontWeight: 600 },
  },
  shape: { borderRadius: 9 },
  components: {
    MuiAlert: {
      styleOverrides: {
        root: { fontSize: 11 },
        message: { overflowWrap: "anywhere" },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 7, minHeight: 36, paddingInline: 14 },
        outlined: {
          borderColor: "#dce2df",
          color: "#3f504a",
          background: "#fff",
        },
      },
    },
    MuiTextField: { defaultProps: { size: "small", fullWidth: true } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { background: "#fff", fontSize: 13 },
        notchedOutline: { borderColor: "#dce2df" },
      },
    },
    MuiChip: {
      styleOverrides: { root: { height: 25, fontSize: 11, fontWeight: 550 } },
    },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 14 } } },
    MuiDialogActions: { styleOverrides: { root: { padding: "16px 24px" } } },
    MuiMenuItem: { styleOverrides: { root: { fontSize: 12 } } },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});
