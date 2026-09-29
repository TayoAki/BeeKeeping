// What the database test setup hands to each test file through Vitest's
// provide and inject. Both sides import this file for the types.
declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseServerUrl: string;
    testDatabaseTemplate: string;
  }
}

export {};
