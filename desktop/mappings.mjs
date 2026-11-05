export function validateMapping(mapping) {
  if (!mapping || typeof mapping.source !== "string" || !mapping.source || mapping.source.length > 2000 || !/^[\w-]{1,60}$/.test(mapping.viewId) || typeof mapping.selector !== "string" || mapping.selector.length > 500 || (mapping.prepare !== undefined && (typeof mapping.prepare !== "string" || mapping.prepare.length > 500))) throw new Error("Choose a source identifier and a bounded counterpart selector.");
  return mapping;
}

// Serialized into the isolated browser world; revalidate on every application.
export function mappedPreparation(mapping, masks, describe, apply = false) {
  const targets = document.querySelectorAll(mapping.selector);
  const buttons = document.querySelectorAll(mapping.prepare);
  if (targets.length !== 1 || buttons.length !== 1 || !buttons[0].matches('[aria-controls][aria-expanded="false"], [aria-controls][aria-expanded="true"]')) throw new Error("The saved preparation control is unavailable.");
  const button = buttons[0];
  const controlled = button.getAttribute("aria-controls").split(/\s+/).map(id => document.getElementById(id));
  if (!controlled.some(node => node?.contains(targets[0]))) throw new Error("The preparation button does not control the mapped counterpart.");
  const descriptor = describe({ type: "describe-element", element: button, desktop: true, masks });
  if (!descriptor || descriptor.risky || descriptor.sensitive) throw new Error("The preparation button is private or consequential.");
  if (apply && button.getAttribute("aria-expanded") === "false") button.click();
  return true;
}
