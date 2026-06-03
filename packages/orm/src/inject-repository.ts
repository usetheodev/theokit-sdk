import { Inject } from "@theokit/di";
import { getRepositoryToken } from "./tokens.js";

export function InjectRepository(entity: unknown, dataSourceName?: string): ParameterDecorator {
  return Inject(getRepositoryToken(entity, dataSourceName));
}
