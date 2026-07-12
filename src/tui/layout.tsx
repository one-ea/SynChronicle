import React from "react";
import { Box } from "ink";

export function ThreeColumnLayout({ sidebar, activity, outline }: { sidebar: React.ReactNode; activity: React.ReactNode; outline: React.ReactNode }) {
  return <Box flexDirection="row" gap={1}><Box width="28%">{sidebar}</Box><Box width="44%">{activity}</Box><Box width="28%">{outline}</Box></Box>;
}
