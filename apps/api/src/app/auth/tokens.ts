// Separate module so auth.guard and auth.module avoid a circular import
// (the symbol must exist when the @Inject decorator runs).
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');
