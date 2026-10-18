import { readFileSync } from "node:fs";
import { approvalCandidates } from "../shared/municipal-approval.ts";

const manifest = JSON.parse(readFileSync(".wrangler/municipal-discovery-dry-run.json", "utf8"));
const candidates = approvalCandidates(manifest.candidates);
console.log(`[승인 후보 ${candidates.length}건]`);
candidates.slice(0, 5).forEach((candidate, index) => {
  const extra = candidate.enrichment_candidate ?? {};
  console.log(`\n${index + 1}. ${candidate.title}\n   날짜: ${candidate.start_date} ~ ${candidate.end_date}\n   장소: ${candidate.venue}\n   지역: ${candidate.region}\n   한줄 소개: ${extra.summary ?? "공식 요약 없음"}\n   주요 정보: ${extra.operating_hours ? `${extra.operating_hours.start_time}~${extra.operating_hours.end_time}` : "공식 운영시간 없음"}\n   MAIN 이유: ${candidate.selection_reason}\n   공식 출처: ${candidate.official_url}\n   공식 이미지 후보: ${candidate.image_candidate ? "있음" : "없음"}\n   candidate ID: ${candidate.candidate_id}`);
});
console.log(`\nmanifest fingerprint: ${manifest.fingerprint}\n승인할 번호 또는 candidate ID를 선택하세요.\napply 예: npm run municipal:apply -- --approve <candidate-id> --manifest ${manifest.fingerprint}`);
