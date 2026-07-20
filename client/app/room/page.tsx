import { Suspense } from "react";
import RoomClient from "./RoomClient";

export default function RoomPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
      </div>
    }>
      <RoomClient />
    </Suspense>
  );
}
