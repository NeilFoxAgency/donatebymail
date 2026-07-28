import { useEffect, useState } from "react";

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
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    const publicId = hash.get("id") || query.get("id") || "";
    const token = hash.get("token") || "";
    if (window.location.hash) history.replaceState({}, "", publicId ? `/track?id=${encodeURIComponent(publicId)}` : "/track");
    if (!publicId || !token) { setMessage("Open the secure tracking link from your donation email."); return; }
    fetch("/api/donations/status", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicId, token }),
    }).then(async (response) => {
      const body = await response.json() as { donation?: StatusData; message?: string };
      if (!response.ok || !body.donation) throw new Error(body.message || "Status unavailable.");
      setDonation(body.donation); setMessage("");
    }).catch((error: Error) => setMessage(error.message));
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
