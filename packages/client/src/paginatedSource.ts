import type {
  TcContact,
  TcLease,
  TcProperty,
  TcTransaction,
  TcUnit,
} from "./models.js";
import type { TcTransactionCategory, TcTransactionStatus } from "./json.js";

export interface Page<T> {
  entries: T[];
  pageNo: number;
  totalEntries: number;
}

export type PageGetter<T> = (
  pageNo: number,
  extraUrl: string,
  signal?: AbortSignal,
) => Promise<Page<T>>;

export class PaginatedSource<T> {
  constructor(
    protected readonly pageGetter: PageGetter<T>,
    protected readonly extraUrl: string = "",
  ) {}

  getPage(pageNo = 1, signal?: AbortSignal): Promise<Page<T>> {
    return this.pageGetter(pageNo, this.extraUrl, signal);
  }

  /**
   * Fetches pages until the server-reported total is reached or the number of
   * collected entries exceeds maxResults. Like the C# version, the result may
   * overshoot maxResults by up to one page.
   */
  async getAll(maxResults = 300, signal?: AbortSignal): Promise<T[]> {
    const result: T[] = [];
    let pageNo = 1;

    while (result.length <= maxResults) {
      signal?.throwIfAborted();
      const { entries, totalEntries } = await this.getPage(pageNo++, signal);
      result.push(...entries);

      if (result.length >= totalEntries || entries.length === 0) {
        break;
      }
    }

    return result;
  }

  protected withExtra(extra: string): this {
    const ctor = this.constructor as new (pageGetter: PageGetter<T>, extraUrl: string) => this;
    return new ctor(this.pageGetter, this.extraUrl + extra);
  }
}

export class ContactsSource extends PaginatedSource<TcContact> {
  onlyTenants(): this {
    return this.withExtra("&filter[roles][]=tenant");
  }

  onlyMovedIn(): this {
    return this.withExtra("&filter[tenant_contact_type]=moved_in");
  }

  onlyProfessionals(): this {
    return this.withExtra("&filter[roles][]=professional");
  }

  onlyArchived(): this {
    return this.withExtra("&filter[status]=archived");
  }
}

export class PropertiesSource extends PaginatedSource<TcProperty> {}

export class UnitsSource extends PaginatedSource<TcUnit> {
  onlyOccupied(): this {
    return this.withExtra("&filter[is_rented]=true");
  }

  onlyVacant(): this {
    return this.withExtra("&filter[is_rented]=false");
  }

  forProperty(propertyId: number): this {
    return this.withExtra(`&filter[property_id][]=${propertyId}`);
  }
}

export class TransactionsSource extends PaginatedSource<TcTransaction> {
  forTenant(tenantId: number): this {
    return this.withExtra(`&filter[client_id]=${tenantId}`);
  }

  forProperty(propertyId: number): this {
    return this.withExtra(`&filter[property_id][]=${propertyId}`);
  }

  forUnit(unitId: number): this {
    return this.withExtra(`&filter[unit_id]=${unitId}`);
  }

  forStatus(status: TcTransactionStatus): this {
    return this.withExtra(`&filter[status]=${status}`);
  }

  forCategory(category: TcTransactionCategory): this {
    return this.withExtra(`&filter[category][]=${category}`);
  }

  sortByDateDescending(): this {
    return this.withExtra("&sort=-date,-id");
  }
}

export class LeasesSource extends PaginatedSource<TcLease> {
  onlyActive(): this {
    return this.withExtra("&filter[lease_status][]=active");
  }

  forProperty(propertyId: number): this {
    return this.withExtra(`&filter[property_id][]=${propertyId}`);
  }

  forUnit(unitId: number): this {
    return this.withExtra(`&filter[unit_id]=${unitId}`);
  }
}
