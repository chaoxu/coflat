declare module "*?raw" {
  const content: string;
  export default content;
}
declare module "*?url" {
  const url: string;
  export default url;
}
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly [key: string]: unknown;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
