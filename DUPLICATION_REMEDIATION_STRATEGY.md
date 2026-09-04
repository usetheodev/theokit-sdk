# Duplicate Code Remediation Strategy

**Goal:** Remediate all 2,915 findings from `DUPLICATE-CODE-REPORT.md`

**Status:** 1/2,915 complete (lance-index.ts consolidation)

---

## Completed

### ✅ 595 lines — `lance-index.ts` (Type-1 exact duplicate)
**Commit:** `3e18c514`
- Canonical: `packages/sdk-memory/src/internal/index/lance-index.ts`
- Removed duplicate from: `packages/sdk/src/internal/memory/lance-index.ts`
- Added re-export of `lanceStoragePath` for API consistency
- Updated imports in dependent files

---

## Remaining Duplications by Category

### 1. High-Severity Code (49 findings, >100 lines each) — ~2,500 lines total

| Size | Count | Example Files | Strategy |
|------|-------|---|---|
| 414L | 1 | tools.ts | Move to sdk-memory (canonical), sdk imports re-export |
| 336L | 1 | normalize-usage.ts (budget) | Extract to shared utility |
| 298L | 1 | migrate-sqlite-to-lance.ts | Already partial consolidation |
| 200-299L | ~15 | Various | Extract utilities by domain |
| 100-199L | ~31 | Various | Case-by-case extraction |

### 2. Medium-Severity (67 findings, 50-100 lines) — ~5,000 lines

- Mix of test helpers and business logic
- Strategy: Extract to domain-specific utility modules

### 3. Configuration Files (11 findings)

- 7x `tsup.config.ts` (varying by ~5%)
- 4x `vitest.config.ts` (varying by ~10%)
- **Challenge:** Configuration differences per-package (external deps, versioning logic)
- **Strategy:** Convert to factory functions, or accept minor duplication (Info severity)

### 4. Test Fixtures & Helpers (2,543 findings, ~63K lines) — HIGHEST PRIORITY

- Spread across 400+ test suite files
- Nearly identical mock factories, fixtures, setup code
- **Strategy:** Consolidate into `packages/test-utils/`
  - Create `packages/test-utils/src/fixtures/`
  - Create `packages/test-utils/src/mocks/`
  - Create `packages/test-utils/src/setup.ts`
  - All test packages import from `@theokit/test-utils`

---

## Recommended Execution Order

### Phase 1: Test Consolidation (Highest Impact)
1. Create `packages/test-utils/package.json` + basic structure
2. Run duplicate database query to find top 50 test fixtures
3. Extract them to `packages/test-utils/`
4. Update all test files to import from shared package
5. **Impact:** Resolves ~2,543 findings (~87% of total)

### Phase 2: High-Severity Code
1. Consolidate `tools.ts` (414L) — Make sdk-memory canonical
2. Extract `normalize-usage.ts` helpers (336L)
3. Address `migrate-sqlite-to-lance.ts` (298L)
4. **Impact:** Resolves ~49 findings

### Phase 3: Medium-Severity
1. Analyze patterns in 67 medium-severity files
2. Group by domain (memory, budget, etc.)
3. Extract to domain utilities
4. **Impact:** Resolves 67 findings

### Phase 4: Configuration Files
1. Evaluate: Keep with warning OR consolidate with factory
2. If consolidating: Create `build/config-factory.ts`
3. Update each package to use factory
4. **Impact:** Resolves 11 findings

---

## Database Query for Batch Processing

```bash
# Find all test fixture duplicates
python3 << 'EOF'
import sqlite3

db = sqlite3.connect('duplication-output/duplication.db')
cursor = db.cursor()

# Find test-related duplications
cursor.execute("""
    SELECT DISTINCT file FROM clone_members
    WHERE file LIKE '%test%' OR file LIKE '%spec%'
    ORDER BY file
    LIMIT 100
""")

for row in cursor.fetchall():
    print(row[0])

db.close()
EOF
```

---

## Implementation Tools

### Script: Find Duplicate Clone Members
```bash
#!/bin/bash
python3 << 'EOF'
import sqlite3, json

db = sqlite3.connect('duplication-output/duplication.db')
cursor = db.cursor()

# Get all clone classes with >10 members (likely fixtures)
cursor.execute("""
    SELECT id, duplicated_lines, member_count
    FROM clone_classes
    WHERE member_count > 1
    ORDER BY duplicated_lines DESC
    LIMIT 50
""")

for class_id, lines, members in cursor.fetchall():
    cursor.execute(f"""
        SELECT file FROM clone_members WHERE class_id = {class_id}
    """)
    files = [f[0] for f in cursor.fetchall()]
    print(f"{lines}L | {members} sites: {files[0]}")
    for f in files[1:]:
        print(f"        {f}")
EOF
```

---

## Notes

- **Unbreakable Rule 4:** All changes remain on `workspace` branch until ready
- **Unbreakable Rule 6:** Update CHANGELOG for each phase
- **Testing:** Verify build passes after each phase: `pnpm build --filter="@theokit/sdk*"`
- **Type checking:** Run `pnpm tsc --noEmit` after all imports changes

---

## Estimated Timeline

- **Phase 1 (Tests):** 4-6 hours (2,543 findings)
- **Phase 2 (High-Sev):** 2-3 hours (49 findings)  
- **Phase 3 (Medium-Sev):** 2-3 hours (67 findings)
- **Phase 4 (Config):** 1-2 hours (11 findings)
- **Total:** ~10-15 hours for full remediation

---

**Next Step:** Decide priority — start with test consolidation for maximum impact.
