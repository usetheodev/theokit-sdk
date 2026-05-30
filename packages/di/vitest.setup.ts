// reflect-metadata must be imported ONCE per process, before any decorator
// metadata is read. Tests run in vitest workers; this setup file is loaded
// before any test module.
import "reflect-metadata";
