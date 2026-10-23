// src/loader/lazy-page.ts
async function loadLazyPage(loader, page, importerPath) {
  const loaded = await loader.load(page.orbRef, importerPath);
  if (!loaded.success) return loaded;
  const { schema, sourcePath } = loaded.data;
  if (!schema.orbitals.some((o) => o.name === page.orbital)) {
    return {
      success: false,
      error: `Lazy page ${page.path} expects orbital "${page.orbital}" in ${sourcePath}, found: ${schema.orbitals.map((o) => o.name).join(", ")}`
    };
  }
  return { success: true, data: schema };
}

export { loadLazyPage };
