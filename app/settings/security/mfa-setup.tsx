"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ShieldCheck, ShieldOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Enrollment = { factorId: string; qrCode: string; secret: string };

export function MfaSetup() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setError(listError.message);
      setLoading(false);
      return;
    }
    const verified = (data?.totp ?? []).find((f) => f.status === "verified");
    setVerifiedFactorId(verified?.id ?? null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function startEnroll() {
    setBusy(true);
    setError(null);
    try {
      // Clear any half-finished (unverified) factor so enrollment starts clean.
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const f of existing?.all ?? []) {
        if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator (${new Date().toISOString().slice(0, 10)})`,
      });
      if (enrollError) throw enrollError;
      setEnrollment({
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      });
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start setup");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll() {
    if (!enrollment) return;
    setBusy(true);
    setError(null);
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: enrollment.factorId,
      });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enrollment.factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyError) throw verifyError;
      setEnrollment(null);
      setCode("");
      setDone(true);
      await refresh();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code didn't match. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelEnroll() {
    if (enrollment) await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId });
    setEnrollment(null);
    setCode("");
    setError(null);
  }

  async function removeFactor() {
    if (!verifiedFactorId) return;
    if (!window.confirm("Turn off two-factor authentication? Your account will be less protected.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: verifiedFactorId });
      if (unenrollError) throw unenrollError;
      setDone(false);
      await refresh();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not turn off");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  // Already protected.
  if (verifiedFactorId && !enrollment) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <CardTitle>Two-factor authentication is on</CardTitle>
          </div>
          <CardDescription>
            You&apos;ll enter a code from your authenticator app when you sign in. This keeps the
            ledger protected even if your password is exposed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {done ? (
            <p className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
              <CheckCircle2 className="h-4 w-4" /> Two-factor authentication enabled.
            </p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button variant="outline" onClick={removeFactor} disabled={busy}>
            <ShieldOff className="h-4 w-4" />
            {busy ? "Working…" : "Turn off"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Mid-enrollment: show the QR + code field.
  if (enrollment) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Scan this with your authenticator app</CardTitle>
          <CardDescription>
            Use Google Authenticator, 1Password, Authy, or any TOTP app, then enter the 6-digit code
            it shows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enrollment.qrCode}
              alt="Two-factor QR code"
              className="h-44 w-44 rounded-lg border border-border bg-white p-2"
            />
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">Can&apos;t scan? Enter this key manually:</p>
              <code className="block break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
                {enrollment.secret}
              </code>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mfa-code">6-digit code</Label>
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="max-w-[160px] tracking-[0.3em]"
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex gap-2">
            <Button onClick={confirmEnroll} disabled={busy || code.length !== 6}>
              {busy ? "Verifying…" : "Verify and turn on"}
            </Button>
            <Button variant="ghost" onClick={cancelEnroll} disabled={busy}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Not set up yet.
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Two-factor authentication</CardTitle>
        </div>
        <CardDescription>
          Add a second step at sign-in: a 6-digit code from an authenticator app on your phone. It
          protects the ledger even if your password is exposed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button onClick={startEnroll} disabled={busy}>
          {busy ? "Starting…" : "Set up"}
        </Button>
      </CardContent>
    </Card>
  );
}
