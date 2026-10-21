'use client';

import React, { createContext, useContext } from 'react';

const CurrentPagePathContext = createContext<string | undefined>(undefined);

export interface CurrentPagePathProviderProps {
  value: string | undefined;
  children: React.ReactNode;
}

export const CurrentPagePathProvider: React.FC<CurrentPagePathProviderProps> = ({
  value,
  children,
}) => (
  <CurrentPagePathContext.Provider value={value}>
    {children}
  </CurrentPagePathContext.Provider>
);

CurrentPagePathProvider.displayName = 'CurrentPagePathProvider';

export const useCurrentPagePath = (): string | undefined => useContext(CurrentPagePathContext);

export { CurrentPagePathContext };
