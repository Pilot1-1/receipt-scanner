import { CATEGORY_OPTIONS, DEFAULT_FILTERS, SORTS, STATUSES, isModified } from "../lib/filters";
import { titleCase } from "../lib/stats";

/** Search box, filters, sorting and CSV export for the Receipts tab. */
export default function ReceiptFilters({ filters, onChange, shown, total, onExport }) {
  const set = (patch) => onChange({ ...filters, ...patch });

  return (
    <div className="filter-block">
      <div className="filter-bar">
        <input
          type="search" className="search" placeholder="Search by store or product"
          aria-label="Search receipts" value={filters.query} onChange={(e) => set({ query: e.target.value })}
        />
        <select aria-label="Category" value={filters.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="all">All categories</option>
          {CATEGORY_OPTIONS.map((name) => <option key={name} value={name}>{titleCase(name)}</option>)}
        </select>
        <select aria-label="Status" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
          {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select aria-label="Sort by" value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button type="button" className="ghost" onClick={onExport} disabled={shown === 0}>Export CSV</button>
      </div>

      <p className="note filter-count" role="status">
        {shown === total ? `${total} ${total === 1 ? "receipt" : "receipts"}` : `${shown} of ${total} receipts`}
        {isModified(filters) && (
          <>
            {" "}
            <button type="button" className="link" onClick={() => onChange(DEFAULT_FILTERS)}>Reset</button>
          </>
        )}
      </p>
    </div>
  );
}
