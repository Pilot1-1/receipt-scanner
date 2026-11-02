// Optional add-ons. Every folder src/addons/<name>/ that has an index.js is picked up when the site is built;
// without such folders the site is just the receipt scanner and nothing here is needed.
//
// What an add-on's index.js exports (by default):
//   { id: "bills", label: "Bills", Panel: SomeComponent, ownScreen: true }
// Panel is shown under the add-on's tab and gets { onExpired } (called when the sign-in has expired).
// ownScreen: true hides the receipt uploader and the receipts' currency switch while that tab is open.
const found = import.meta.glob("./addons/*/index.js", { eager: true });

export const extensions = Object.values(found)
  .map((module) => module.default)
  .filter((extension) => extension && extension.id && extension.label && extension.Panel);
