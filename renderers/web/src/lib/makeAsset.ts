import type { Asset, EntityRole } from '@almadar/core';

const ROLE_DEFAULTS: Record<string, Pick<Asset, 'dimension' | 'animations' | 'aspect'>> = {
    tile:       { dimension: '2d', animations: ['static'], aspect: '1:1' },
    decoration: { dimension: '2d', animations: ['static'], aspect: '1:1' },
    effect:     { dimension: '2d', animations: ['static'], aspect: '1:1' },
    item:       { dimension: '2d', animations: ['static'], aspect: '5:7' },
    player:     { dimension: '2d', animations: ['idle', 'walk', 'attack', 'hit', 'death'], aspect: '1:1' },
    enemy:      { dimension: '2d', animations: ['idle', 'walk', 'attack', 'hit', 'death'], aspect: '1:1' },
    npc:        { dimension: '2d', animations: ['idle', 'walk', 'attack', 'hit', 'death'], aspect: '1:1' },
    projectile: { dimension: '2d', animations: ['static'], aspect: '1:1' },
    vehicle:    { dimension: '2d', animations: ['idle', 'walk'], aspect: '1:1' },
    ui:         { dimension: '2d', animations: ['static'], aspect: '1:1' },
};

/** Build an Asset from a url + the slot's role. Slot-fixed defaults by role. */
export function makeAsset(url: string, role: EntityRole, overrides: Partial<Asset> = {}): Asset {
    const defaults = ROLE_DEFAULTS[role] ?? { dimension: '2d', animations: ['static'], aspect: '1:1' };
    return {
        url,
        role,
        category: url.split('/').pop()?.replace(/\.[^.]+$/, '') ?? role,
        ...defaults,
        ...overrides,
    };
}

/** Map a name→url record to name→Asset. */
export function makeAssetMap(
    record: Record<string, string>,
    role: EntityRole,
    overrides: Partial<Asset> = {},
): Record<string, Asset> {
    const result: Record<string, Asset> = {};
    for (const [key, url] of Object.entries(record)) {
        result[key] = makeAsset(url, role, overrides);
    }
    return result;
}
