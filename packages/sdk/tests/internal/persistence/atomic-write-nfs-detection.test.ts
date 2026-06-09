/**
 * T5.8 — NFS / SMB / FUSE / CIFS detection + warn-once on atomic write
 * (DR6 finding #8).
 *
 * Pre-T5.8 `replaceFileAtomic` happily called `rename(tmp, filePath)`
 * on any filesystem. POSIX `rename` is atomic on local filesystems
 * (ext4, btrfs, APFS, NTFS), but on network filesystems (NFS, SMB,
 * CIFS) and many FUSE implementations atomicity is best-effort:
 *
 *   - NFS: server-side rename can succeed but client-side cache
 *     reads may return the old file for seconds after — readers
 *     observe an apparent "rollback" that wasn't there on disk.
 *   - SMB / CIFS: rename across directories is non-atomic on some
 *     server implementations (Samba's `noatime` mode in particular).
 *   - FUSE: depends entirely on the FS implementation; sshfs, s3fs,
 *     and rclone-mount have known non-atomic rename behavior.
 *
 * T5.8 does NOT change the write path — `replaceFileAtomic` remains
 * a best-effort atomic write. T5.8 ADDS a warn-once-per-directory
 * telemetry surface so operators see "[theokit-sdk] atomic-write
 * detected network fs (nfs) at /mnt/share — atomicity guarantees
 * may be weaker than expected" and know to plan accordingly. The
 * pattern mirrors `sqlite-wal.ts:54-61`'s warn-once-per-label.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __TESTING__detectNetworkFsName,
  __TESTING__resetNfsWarnings,
} from "../../../src/internal/persistence/atomic-write.js";

describe("T5.8 — detectNetworkFsName by Linux magic numbers", () => {
  it("identifies NFS by magic 0x6969", () => {
    expect(__TESTING__detectNetworkFsName(0x6969)).toBe("nfs");
  });

  it("identifies SMB by magic 0x517B", () => {
    expect(__TESTING__detectNetworkFsName(0x517b)).toBe("smb");
  });

  it("identifies CIFS by magic 0xFF534D42", () => {
    expect(__TESTING__detectNetworkFsName(0xff534d42)).toBe("cifs");
  });

  it("identifies FUSE by magic 0x65735546", () => {
    expect(__TESTING__detectNetworkFsName(0x65735546)).toBe("fuse");
  });

  it("returns null for ext4 (local)", () => {
    expect(__TESTING__detectNetworkFsName(0xef53)).toBeNull();
  });

  it("returns null for btrfs (local)", () => {
    expect(__TESTING__detectNetworkFsName(0x9123683e)).toBeNull();
  });

  it("returns null for tmpfs (local)", () => {
    expect(__TESTING__detectNetworkFsName(0x01021994)).toBeNull();
  });

  it("returns null for unknown magic", () => {
    expect(__TESTING__detectNetworkFsName(0xdeadbeef)).toBeNull();
  });
});

describe("T5.8 — warn-once registry resets cleanly", () => {
  beforeEach(() => {
    __TESTING__resetNfsWarnings();
  });

  afterEach(() => {
    __TESTING__resetNfsWarnings();
  });

  it("resetNfsWarnings is a no-throw idempotent helper", () => {
    expect(() => __TESTING__resetNfsWarnings()).not.toThrow();
    expect(() => __TESTING__resetNfsWarnings()).not.toThrow();
  });
});
