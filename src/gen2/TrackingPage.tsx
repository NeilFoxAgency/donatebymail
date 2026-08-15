import { useEffect, useRef, useState } from "react";
import { publicApi } from "./AuthSession";

type StatusData = {
  publicId: string;
  status: string;
  charityName: string;
  createdAt: string;
  receivedAt?: string;
  devices: Array<{ id: string; label: string; receiptStatus: string; inspectionStatus: string; processingStatus: string; dataWipeStatus: string }>;
  events: Array<{ status: string; message: string; occurredAt: string }>;
};

export function TrackingPage() {
  const [donation, setDonation] = useState<StatusData | null>(null);
  const [message, setMessage] = useState("Loading your donation status…");
  const mountedRef = useRef(false);
  const requestStartedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    if (requestStartedRef.current) return () => { mountedRef.current = false; };
    requestStartedRef.current = true;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    const publicId = hash.get("id") || query.get("id") || "";
    const token = hash.get("token") || "";
    if (!publicId || !token) {
      setMessage("Open the secure tracking link from your donation email.");
      return () => { mountedRef.current = false; };
    }
    publicApi<{ donation?: StatusData }>("/api/donations/status", {
      method: "POST", body: JSON.stringify({ publicId, token }),
    }).then((body) => {
      if (!body.donation) throw new Error("Status unavailable.");
      if (!mountedRef.current) return;
      setDonation(body.donation); setMessage("");
      // Keep the capability available for a retry if the request failed. Once
      // the server has returned the status, remove it from the visible URL.
      if (window.location.hash) window.history.replaceState({}, "", `/track?id=${encodeURIComponent(publicId)}`);
    }).catch((error: Error) => { if (mountedRef.current) setMessage(error.message); });
    return () => { mountedRef.current = false; };
  }, []);
  return <main className="operations-main">
    <section className="operations-shell">
      <p className="kicker">Donation tracking</p>
      <h1>{donation ? donation.publicId : "Track your phone donation"}</h1>
      {message && <p role="status">{message}</p>}
      {donation && <>
        <div className="status-banner"><strong>{donation.status.replace(/_/g, " ")}</strong><span>Supporting {donation.charityName}</span></div>
        <h2>Status history</h2>
        <ol className="status-timeline">{donation.events.map((event, index) => <li key={`${event.occurredAt}-${index}`}><strong>{event.status.replace(/_/g, " ")}</strong><span>{event.message}</span><time>{new Date(event.occurredAt).toLocaleString()}</time></li>)}</ol>
        <h2>Devices</h2>
        <div className="device-status-grid">{donation.devices.map((device) => <article key={device.id}><h3>{device.label || "Phone"}</h3><p>Receipt: {device.receiptStatus}<br />Inspection: {device.inspectionStatus}<br />Processing: {device.processingStatus}<br />Data wipe: {device.dataWipeStatus}</p></article>)}</div>
        <p className="privacy-note">This page contains no address or email details. Donate by Mail will never ask for your phone passcode.</p>
      </>}
    </section>
  </main>;
}
