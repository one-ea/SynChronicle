export interface ContextPack<T = unknown> {
  consumer: "coordinator" | "architect" | "writer" | "editor";
  context: T;
}

function pack<T>(consumer: ContextPack["consumer"], context: T): ContextPack<T> {
  return { consumer, context: structuredClone(context) };
}

export const packCoordinator = <T>(context: T) => pack("coordinator", context);
export const packArchitect = <T>(context: T) => pack("architect", context);
export const packWriter = <T>(context: T) => pack("writer", context);
export const packEditor = <T>(context: T) => pack("editor", context);
