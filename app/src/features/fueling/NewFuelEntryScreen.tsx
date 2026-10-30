import React from 'react';
import { FuelEntryForm } from './FuelEntryForm';

export function NewFuelEntryScreen({ embeddedInShell = false }: { embeddedInShell?: boolean } = {}) {
  return <FuelEntryForm embeddedInShell={embeddedInShell} />;
}
