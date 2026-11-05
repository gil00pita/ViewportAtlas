// Serialized into the evidence world. Frames and opaque custom elements are masked
// as whole regions because their internal private fields cannot be inspected safely.
export function privateElements(selectors, root = document) {
  const elements = [...root.querySelectorAll(selectors), ...root.querySelectorAll('iframe,frame,object,embed')];
  for (const node of root.querySelectorAll('*')) {
    if (node.shadowRoot) elements.push(...privateElements(selectors, node.shadowRoot));
    else if (node.localName?.includes('-')) elements.push(node);
  }
  return [...new Set(elements)];
}
