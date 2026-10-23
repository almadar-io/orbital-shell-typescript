// src/client/trait-mount-error.ts
var TraitMountError = class extends Error {
  trait;
  event;
  original;
  constructor(trait, event, original) {
    super(original.message);
    this.name = "TraitMountError";
    this.trait = trait;
    this.event = event;
    this.original = original;
  }
};

export { TraitMountError };
