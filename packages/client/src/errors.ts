export class TcClientError extends Error {
  readonly httpStatus: number;

  constructor(httpStatus: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TcClientError";
    this.httpStatus = httpStatus;
  }
}
