// What the database test setup hands to each test file through Vitest's
// provide and inject. Both sides import this file for the types.
declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseServerUrl: string;
    testDatabaseTemplate: string;
    /** The app's login for this run: it can switch to the app's two roles. */
    testDatabaseAppLogin: { user: string; password: string };
  }
}

export {};
