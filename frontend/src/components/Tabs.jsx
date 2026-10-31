/** Accessible tab bar: arrow keys move between tabs, Home/End jump to the first/last one. */
export default function Tabs({ tabs, active, onChange }) {
  function onKeyDown(event) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const current = tabs.findIndex((tab) => tab.id === active);
    let next = step === undefined ? -1 : (current + step + tabs.length) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    onChange(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  }

  return (
    <div className="tabs" role="tablist" aria-label="Sections" onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id} id={`tab-${tab.id}`} role="tab" type="button"
          aria-selected={tab.id === active} aria-controls={`panel-${tab.id}`}
          tabIndex={tab.id === active ? 0 : -1}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {typeof tab.count === "number" && <span className="tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
