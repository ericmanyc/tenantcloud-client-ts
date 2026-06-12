/**
 * Contacts (writes). Reads stay on `client.contacts` (PaginatedSource); this
 * client adds create/update/invite/delete and contact insurances.
 *
 * The JSON:API resource type for a contact is `userClient` (note camelCase),
 * and several attributes are camelCase too (firstName, lastName, isCompany).
 *
 * Endpoints:
 *   POST   /contacts                 create
 *   GET/PATCH/DELETE /contacts/{id}
 *   POST   /contacts/invite          invite to the tenant portal
 *   GET/POST /contacts/insurances (+ /{id})
 */
import { parseContact, type TcContact } from "../models.js";
import {
  jsonApiBody,
  parseJsonApiList,
  parseJsonApiOne,
  withQuery,
  type JsonApiList,
  type JsonApiRecord,
  type TcHttp,
} from "./jsonApi.js";

const CONTACT_TYPE = "userClient";

export class ContactsClient {
  constructor(private readonly http: TcHttp) {}

  async get(id: number, signal?: AbortSignal): Promise<TcContact | null> {
    const one = parseJsonApiOne(await this.http.request("GET", `/contacts/${id}`, { signal }));
    return one ? parseContact(one) : null;
  }

  /**
   * Create a contact. Attribute keys are camelCase for names
   * (firstName, lastName, middleName, company, isCompany) and the email/phone.
   */
  async create(attributes: Record<string, unknown>, signal?: AbortSignal): Promise<TcContact | null> {
    const one = parseJsonApiOne(
      await this.http.request("POST", "/contacts", {
        body: jsonApiBody(CONTACT_TYPE, attributes),
        signal,
      }),
    );
    return one ? parseContact(one) : null;
  }

  async update(
    id: number,
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TcContact | null> {
    const one = parseJsonApiOne(
      await this.http.request("PATCH", `/contacts/${id}`, {
        body: jsonApiBody(CONTACT_TYPE, attributes, id),
        signal,
      }),
    );
    return one ? parseContact(one) : null;
  }

  async delete(id: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("DELETE", `/contacts/${id}`, { signal });
  }

  /** Invite a contact to the tenant portal. */
  invite(attributes: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.http.request("POST", "/contacts/invite", {
      body: jsonApiBody(CONTACT_TYPE, attributes),
      signal,
    });
  }

  listInsurances(
    options: { page?: number | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<JsonApiList> {
    return this.http
      .request("GET", withQuery("/contacts/insurances", { page: options.page }), {
        signal: options.signal,
      })
      .then(parseJsonApiList);
  }

  async addInsurance(
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonApiRecord | null> {
    return parseJsonApiOne(
      await this.http.request("POST", "/contacts/insurances", {
        body: jsonApiBody("contact_insurance", attributes),
        signal,
      }),
    );
  }
}
