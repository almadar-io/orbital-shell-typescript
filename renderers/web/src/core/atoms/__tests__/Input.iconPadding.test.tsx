import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Input, EventBusProvider } from '../../index';

const LEADING = 'pl-[calc(var(--icon-default-size,16px)+1.5rem)]';

function renderInput(props: React.ComponentProps<typeof Input>) {
    return render(
        <EventBusProvider debug={false}>
            <Input {...props} />
        </EventBusProvider>,
    );
}

describe('G-ORBITAL-SHELL-TYPESCRIPT-070 leading-icon padding', () => {
    it('sizes the leading padding from the icon token, so a large-icon theme keeps text room', () => {
        const { getByLabelText } = renderInput({ label: 'Search', icon: 'search' });
        expect(getByLabelText('Search').className).toContain(LEADING);
        expect(getByLabelText('Search').className).not.toContain('pl-10');
    });

    it('control: no icon adds no leading padding', () => {
        const { getByLabelText } = renderInput({ label: 'Search' });
        expect(getByLabelText('Search').className).not.toContain('pl-[');
    });
});
