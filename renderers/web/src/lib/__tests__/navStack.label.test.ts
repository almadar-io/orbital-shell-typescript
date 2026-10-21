import { describe, it, expect } from 'vitest';
import { syncNavStack, pageEntryLabel, navLabelsFromItems, resolveEntryLabels } from '../../core';

describe('nav stack entry labels', () => {
  it('uses the declared page label', () => {
    expect(pageEntryLabel({ path: '/contacts', name: 'ContactsPage', orbital: 'Crm', label: 'جهات الاتصال' })).toBe('جهات الاتصال');
  });

  it('control: without a label, the page name as written', () => {
    expect(pageEntryLabel({ path: '/contacts', name: 'ContactDetailPage', orbital: 'Crm' })).toBe('ContactDetailPage');
  });

  it('seeded ancestors use declared labels too', () => {
    const pages = [
      { path: '/contacts', name: 'ContactsPage', orbital: 'Crm', label: 'Contacts' },
      { path: '/contacts/:id', name: 'ContactDetailPage', orbital: 'Crm', label: 'Contact' },
    ];
    const { state } = syncNavStack({}, pages, '/contacts/7', null);
    expect(state.Crm.map((e) => e.label)).toEqual(['Contacts', 'Contact']);
  });
});

describe('nav stack labels from declared navItems', () => {
  const pages = [
    { path: '/projects', name: 'ProjectsPage', orbital: 'Pm' },
    { path: '/projects/:id', name: 'ProjectDetailPage', orbital: 'Pm' },
    { path: '/reports', name: 'ReportsPage', orbital: 'Pm', label: 'Declared Reports' },
  ];

  it('maps each navItem href to the page it resolves to', () => {
    const labels = navLabelsFromItems(pages, [{ href: '/projects', label: 'Projects' }]);
    expect(labels).toEqual({ '/projects': 'Projects' });
  });

  it('nested navItem children count too', () => {
    const labels = navLabelsFromItems(pages, [{ href: '/x', label: 'Group', children: [{ href: '/projects', label: 'Projects' }] }]);
    expect(labels).toEqual({ '/projects': 'Projects' });
  });

  it('control: a navItem href matching no declared page is ignored', () => {
    expect(navLabelsFromItems(pages, [{ href: '/nowhere', label: 'Nowhere' }])).toEqual({});
  });

  it('a seeded ancestor takes the navItem label instead of the page name', () => {
    const { state } = syncNavStack({}, pages, '/projects/7', null);
    const resolved = resolveEntryLabels(state.Pm, pages, { '/projects': 'Projects' });
    expect(resolved.map((e) => e.label)).toEqual(['Projects', 'ProjectDetailPage']);
  });

  it('a declared page label beats the navItem label', () => {
    const entries = [{ href: '/reports', label: 'Declared Reports' }];
    expect(resolveEntryLabels(entries, pages, { '/reports': 'Nav Reports' })[0].label).toBe('Declared Reports');
  });

  it('control: a record crumb (staged title) is never replaced', () => {
    const entries = [{ href: '/projects', label: 'Prairie Quartz' }];
    expect(resolveEntryLabels(entries, pages, { '/projects': 'Projects' })[0].label).toBe('Prairie Quartz');
  });

  it('without navItems the entries are unchanged', () => {
    const entries = [{ href: '/projects', label: 'ProjectsPage' }];
    expect(resolveEntryLabels(entries, pages, {})).toEqual(entries);
  });
});
