declare module "*.css";

declare module "*.svg" {
  const url: string;
  export default url;
}
declare module "*?worker" {
  const WorkerConstructor: { new (): Worker };
  export default WorkerConstructor;
}
