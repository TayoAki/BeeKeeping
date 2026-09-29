// What the database test setup hands to each test file through Vitest's
// provide and inject. Both sides import this file for the types.
declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseServerUrl: string;
    testDatabaseTemplate: string;
    /** The app's login for this test run: a member of beekeeping_app. */
    testDatabaseAppLogin: { user: string; password: string };
  }
}

export {};
