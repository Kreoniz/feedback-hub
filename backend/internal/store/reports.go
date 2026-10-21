package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrNotFound = errors.New("not found")
var ErrInvalid = errors.New("invalid operation")
var ErrCooldown = errors.New("vote cooldown")

type Context struct {
	PageURL    string `json:"page_url,omitempty"`
	Browser    string `json:"browser,omitempty"`
	AppVersion string `json:"app_version,omitempty"`
}
type Feature struct {
	ID          string    `json:"id"`
	Project     string    `json:"project"`
	ProjectName string    `json:"project_name"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	Votes       int       `json:"votes"`
	Voted       bool      `json:"voted"`
	CreatedAt   time.Time `json:"created_at"`
}
type Report struct {
	Feature
	Type        string    `json:"type"`
	Details     string    `json:"details"`
	Context     Context   `json:"context"`
	Moderation  string    `json:"moderation"`
	Priority    string    `json:"priority"`
	Information string    `json:"information"`
	DuplicateOf *string   `json:"duplicate_of"`
	AdminNote   string    `json:"admin_note"`
	UpdatedAt   time.Time `json:"updated_at"`
}
type Submission struct {
	ID, Project, Type, Title, Description, Details string
	Context                                        Context
	Fingerprint                                    []byte
}
type Filter struct {
	Project, Type, Status, Moderation, Priority, Information, Q, Sort string
	Limit, Offset                                                     int
}
type Patch struct {
	Status, Priority, Information, Moderation, AdminNote *string
	DuplicateSet                                         bool
	DuplicateOf                                          *string
}

var ProjectNames = map[string]string{"campus": "Marvin Campus", "unlikely-ui": "Unlikely UI", "other": "Другое"}

// ErrBudget deliberately applies to duplicates too once admission is paused, so
// storage-budget state cannot become a private-content existence oracle.
var ErrBudget = errors.New("admission budget reached")

const MaxDailyReports = 2000
const MaxProjectDailyReports = 500
const MaxTotalReports = 50000
const MaxTotalVotes = 250000
const VoteCooldownSeconds = 60

func (s *Store) Submit(ctx context.Context, r Submission) (bool, error) {
	b, err := json.Marshal(r.Context)
	if err != nil {
		return false, err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer rollback(tx)
	// This ledger lock survives process restarts and serializes the last available
	// budget slot across concurrent submissions from different network identities.
	var total int
	if err = tx.QueryRow(ctx, `SELECT reports FROM intake_totals WHERE id=true FOR UPDATE`).Scan(&total); err != nil {
		return false, err
	}
	var daily, projectDaily int
	if err = tx.QueryRow(ctx, `SELECT COALESCE(sum(accepted) FILTER(WHERE project='*'),0),COALESCE(sum(accepted) FILTER(WHERE project=$1),0) FROM intake_days WHERE day=(now() AT TIME ZONE 'UTC')::date`, r.Project).Scan(&daily, &projectDaily); err != nil {
		return false, err
	}
	if total >= MaxTotalReports || daily >= MaxDailyReports || projectDaily >= MaxProjectDailyReports {
		return false, ErrBudget
	}
	tag, err := tx.Exec(ctx, `INSERT INTO reports(id,project,type,title,description,details,context,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(fingerprint) DO NOTHING`, r.ID, r.Project, r.Type, r.Title, r.Description, r.Details, b, r.Fingerprint)
	if err != nil {
		return false, err
	}
	duplicate := tag.RowsAffected() == 0
	if !duplicate {
		if _, err = tx.Exec(ctx, `UPDATE intake_totals SET reports=reports+1 WHERE id=true`); err != nil {
			return false, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO intake_days(day,project,accepted) VALUES((now() AT TIME ZONE 'UTC')::date,'*',1),((now() AT TIME ZONE 'UTC')::date,$1,1) ON CONFLICT(day,project) DO UPDATE SET accepted=intake_days.accepted+1`, r.Project); err != nil {
			return false, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return false, err
	}
	return duplicate, nil
}

const featureColumns = `r.id::text,r.project,r.title,r.description,r.status,(SELECT count(*) FROM votes v WHERE v.report_id=r.id),EXISTS(SELECT 1 FROM votes v WHERE v.report_id=r.id AND v.visitor=$1),r.created_at`
const reportColumns = featureColumns + `,r.type,r.details,r.context,r.moderation,r.priority,r.information,r.duplicate_of::text,r.admin_note,r.updated_at`

func scanFeature(row pgx.Row) (Feature, error) {
	var f Feature
	err := row.Scan(&f.ID, &f.Project, &f.Title, &f.Description, &f.Status, &f.Votes, &f.Voted, &f.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return f, ErrNotFound
	}
	f.ProjectName = ProjectNames[f.Project]
	return f, err
}

func scanReport(row pgx.Row) (Report, error) {
	var r Report
	var raw []byte
	err := row.Scan(&r.ID, &r.Project, &r.Title, &r.Description, &r.Status, &r.Votes, &r.Voted, &r.CreatedAt, &r.Type, &r.Details, &raw, &r.Moderation, &r.Priority, &r.Information, &r.DuplicateOf, &r.AdminNote, &r.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	if err != nil {
		return r, err
	}
	if err = json.Unmarshal(raw, &r.Context); err != nil {
		return r, err
	}
	r.ProjectName = ProjectNames[r.Project]
	return r, nil
}
func (s *Store) Get(ctx context.Context, id string) (Report, error) {
	return scanReport(s.Pool.QueryRow(ctx, `SELECT `+reportColumns+` FROM reports r WHERE r.id=$2`, []byte{}, id))
}
func (s *Store) List(ctx context.Context, f Filter, public bool, visitor []byte) ([]Report, int, error) {
	args := []any{visitor}
	where := []string{"true"}
	if public {
		where = append(where, "r.type='feature' AND r.moderation='approved' AND r.duplicate_of IS NULL")
	}
	for _, v := range []struct{ column, value string }{{"project", f.Project}, {"type", f.Type}, {"status", f.Status}, {"moderation", f.Moderation}, {"priority", f.Priority}, {"information", f.Information}} {
		if v.value != "" {
			args = append(args, v.value)
			where = append(where, "r."+v.column+"=$"+itoa(len(args)))
		}
	}
	if f.Q != "" {
		args = append(args, f.Q)
		where = append(where, `(strpos(lower(r.title),lower($`+itoa(len(args))+`))>0 OR strpos(lower(r.description),lower($`+itoa(len(args))+`))>0)`)
	}
	order := "r.created_at DESC,r.id"
	switch f.Sort {
	case "old":
		order = "r.created_at,r.id"
	case "votes":
		order = "6 DESC,r.created_at DESC,r.id"
	case "priority":
		order = `CASE r.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,r.created_at DESC,r.id`
	}
	// One repeatable-read snapshot makes total and items consistent, including empty pages.
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, 0, err
	}
	defer rollback(tx)
	var total int
	// $1 is a typed unused parameter in the count query, preserving shared numbering.
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM reports r WHERE $1::bytea IS NOT NULL AND `+strings.Join(where, " AND "), args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, f.Limit, f.Offset)
	columns := reportColumns
	if public {
		columns = featureColumns
	}
	rows, err := tx.Query(ctx, `SELECT `+columns+` FROM reports r WHERE `+strings.Join(where, " AND ")+` ORDER BY `+order+` LIMIT $`+itoa(len(args)-1)+` OFFSET $`+itoa(len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	items := make([]Report, 0)
	for rows.Next() {
		var r Report
		var err error
		if public {
			r.Feature, err = scanFeature(rows)
		} else {
			r, err = scanReport(rows)
		}
		if err != nil {
			rows.Close()
			return nil, 0, err
		}
		items = append(items, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, 0, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, 0, err
	}
	return items, total, nil
}
func itoa(n int) string {
	const digits = "0123456789"
	if n < 10 {
		return string(digits[n])
	}
	return itoa(n/10) + string(digits[n%10])
}

func (s *Store) Vote(ctx context.Context, id string, visitor, network []byte) (int, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer rollback(tx)
	var visible bool
	err = tx.QueryRow(ctx, `SELECT type='feature' AND moderation='approved' AND duplicate_of IS NULL FROM reports WHERE id=$1 FOR UPDATE`, id).Scan(&visible)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && !visible {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM votes WHERE report_id=$1 AND visitor=$2)`, id, visitor).Scan(&exists); err != nil {
		return 0, err
	}
	if !exists {
		tag, err := tx.Exec(ctx, `INSERT INTO vote_cooldowns(report_id,network,expires_at) VALUES($1,$2,now()+interval '60 seconds') ON CONFLICT(report_id,network) DO UPDATE SET expires_at=EXCLUDED.expires_at WHERE vote_cooldowns.expires_at<=now()`, id, network)
		if err != nil {
			return 0, err
		}
		if tag.RowsAffected() == 0 {
			return 0, ErrCooldown
		}
		var totalVotes int
		if err = tx.QueryRow(ctx, `SELECT votes FROM intake_totals WHERE id=true FOR UPDATE`).Scan(&totalVotes); err != nil {
			return 0, err
		}
		if totalVotes >= MaxTotalVotes {
			return 0, ErrBudget
		}
		if _, err = tx.Exec(ctx, `UPDATE intake_totals SET votes=votes+1 WHERE id=true`); err != nil {
			return 0, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO votes(report_id,visitor) VALUES($1,$2) ON CONFLICT DO NOTHING`, id, visitor); err != nil {
			return 0, err
		}
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM votes WHERE report_id=$1`, id).Scan(&count); err != nil {
		return 0, err
	}
	if err = tx.Commit(ctx); err != nil {
		return 0, err
	}
	return count, nil
}
func (s *Store) Update(ctx context.Context, id string, p Patch) (Report, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Report{}, err
	}
	defer rollback(tx)
	// Serialize duplicate graph edits, preventing concurrent reciprocal links/cycles.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(482334913)`); err != nil {
		return Report{}, err
	}
	var typ, project string
	if err = tx.QueryRow(ctx, `SELECT type,project FROM reports WHERE id=$1 FOR UPDATE`, id).Scan(&typ, &project); errors.Is(err, pgx.ErrNoRows) {
		return Report{}, ErrNotFound
	} else if err != nil {
		return Report{}, err
	}
	if typ == "bug" && p.Moderation != nil && *p.Moderation == "approved" {
		return Report{}, ErrInvalid
	}
	if p.DuplicateSet && p.DuplicateOf != nil {
		var targetType, targetProject string
		if err = tx.QueryRow(ctx, `SELECT type,project FROM reports WHERE id=$1`, *p.DuplicateOf).Scan(&targetType, &targetProject); errors.Is(err, pgx.ErrNoRows) {
			return Report{}, ErrInvalid
		} else if err != nil {
			return Report{}, err
		}
		if targetType != typ || targetProject != project || *p.DuplicateOf == id {
			return Report{}, ErrInvalid
		}
		var cycle bool
		if err = tx.QueryRow(ctx, `WITH RECURSIVE chain AS (SELECT id,duplicate_of FROM reports WHERE id=$1 UNION SELECT r.id,r.duplicate_of FROM reports r JOIN chain c ON r.id=c.duplicate_of) SELECT EXISTS(SELECT 1 FROM chain WHERE id=$2)`, *p.DuplicateOf, id).Scan(&cycle); err != nil {
			return Report{}, err
		}
		if cycle {
			return Report{}, ErrInvalid
		}
	}
	_, err = tx.Exec(ctx, `UPDATE reports SET status=COALESCE($2,status),priority=COALESCE($3,priority),information=COALESCE($4,information),moderation=COALESCE($5,moderation),admin_note=COALESCE($6,admin_note),duplicate_of=CASE WHEN $7 THEN $8::uuid ELSE duplicate_of END,updated_at=now() WHERE id=$1`, id, p.Status, p.Priority, p.Information, p.Moderation, p.AdminNote, p.DuplicateSet, p.DuplicateOf)
	if err != nil {
		return Report{}, err
	}
	r, err := scanReport(tx.QueryRow(ctx, `SELECT `+reportColumns+` FROM reports r WHERE r.id=$2`, []byte{}, id))
	if err != nil {
		return Report{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Report{}, err
	}
	return r, nil
}
