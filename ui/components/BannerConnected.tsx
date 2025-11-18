import React from "react";
import { useAtom } from "jotai";
import { alertTextAtom } from "../state/atoms";
import Banner from "./Banner";

export default function BannerConnected() {
  const [alertText, setAlertText] = useAtom(alertTextAtom as any);
  if (!alertText) return null;
  return <Banner text={String(alertText)} onClose={() => setAlertText(null)} />;
}
