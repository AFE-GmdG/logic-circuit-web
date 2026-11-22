// Einzelne Eigenschaftsänderung mit Von-Zustand (before) und Nach-Zustand (after)
type PropertyChange<T = unknown> = {
  before: T;
  after: T;
};

export default PropertyChange;
