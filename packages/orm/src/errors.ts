export class OrmError extends Error {
  override readonly name: string = "OrmError";
}

export class OrmConfigurationError extends OrmError {
  override readonly name = "OrmConfigurationError";
}

export class OrmValidationError extends OrmError {
  override readonly name = "OrmValidationError";
}

export class OrmSchemaExportError extends OrmError {
  override readonly name = "OrmSchemaExportError";
}
