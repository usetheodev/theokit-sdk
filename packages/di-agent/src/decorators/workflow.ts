import "reflect-metadata";
import { METADATA_KEYS } from "@theokit/di";

export interface WorkflowOptions {
  name?: string;
  retryPolicy?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export function Workflow(options: WorkflowOptions = {}): ClassDecorator {
  return (target: Function) => {
    Reflect.defineMetadata(METADATA_KEYS.WORKFLOW, options, target);
  };
}

export function readWorkflowMetadata(target: Function): WorkflowOptions | undefined {
  return Reflect.getMetadata(METADATA_KEYS.WORKFLOW, target) as WorkflowOptions | undefined;
}
