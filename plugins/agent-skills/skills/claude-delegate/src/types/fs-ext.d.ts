declare module "fs-ext" {
  export function flockSync(
    fd: number,
    flags: "ex" | "sh" | "un" | "exnb" | "shnb",
  ): void;
}
