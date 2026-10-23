// A message safe to show a visitor, with the HTTP status to send it with.
// Kept in its own file so endpoints that only need this don't load the
// Anthropic SDK and the food data at cold start.
export class UserFacingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
