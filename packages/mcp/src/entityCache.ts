import {
  propertyAddress,
  type TcClient,
  type TcContact,
  type TcProperty,
  type TcUnit,
} from "tenantcloud-client";

const CACHE_TTL_MS = 5 * 60_000;

/** Caches properties, units, and contacts for fast ID-to-name resolution. */
export class EntityCache {
  private properties: Map<number, TcProperty> | null = null;
  private units: Map<number, TcUnit> | null = null;
  private contacts: Map<number, TcContact> | null = null;
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(private readonly client: TcClient) {}

  async getPropertyName(id: number): Promise<string | null> {
    await this.ensureCache();
    const property = this.properties!.get(id);
    return property ? (property.name ?? propertyAddress(property)) : null;
  }

  async getUnitName(id: number): Promise<string | null> {
    await this.ensureCache();
    return this.units!.get(id)?.name ?? null;
  }

  async getContactName(id: number): Promise<string | null> {
    await this.ensureCache();
    return this.contacts!.get(id)?.name ?? null;
  }

  async getProperty(id: number): Promise<TcProperty | null> {
    await this.ensureCache();
    return this.properties!.get(id) ?? null;
  }

  async getUnit(id: number): Promise<TcUnit | null> {
    await this.ensureCache();
    return this.units!.get(id) ?? null;
  }

  async getContact(id: number): Promise<TcContact | null> {
    await this.ensureCache();
    return this.contacts!.get(id) ?? null;
  }

  private async ensureCache(): Promise<void> {
    if (this.properties && Date.now() - this.loadedAt < CACHE_TTL_MS) {
      return;
    }

    this.loading ??= this.loadCache().finally(() => {
      this.loading = null;
    });
    await this.loading;
  }

  private async loadCache(): Promise<void> {
    const [properties, units, contacts] = await Promise.all([
      this.client.properties.getAll(),
      this.client.units.getAll(),
      this.client.contacts.getAll(),
    ]);

    this.properties = new Map(properties.map((p) => [p.id, p]));
    this.units = new Map(units.map((u) => [u.id, u]));
    this.contacts = new Map(contacts.map((c) => [c.id, c]));

    // Add the signed-in user to the contacts map so that user_payer_id
    // references can be resolved to a name.
    const user = await this.client.getUserInfo();
    if (user && !this.contacts.has(user.id)) {
      this.contacts.set(user.id, {
        id: user.id,
        email1: user.email,
        email2: null,
        email3: null,
        phone1: user.phone,
        phone2: null,
        phone3: null,
        firstName: user.firstName,
        lastName: user.lastName,
        name: `${user.firstName} ${user.lastName}`.trim(),
      });
    }

    this.loadedAt = Date.now();
  }
}
