import {
  classifyFactTags,
  type FactCandidate,
  type FactDocument,
} from "./fact-tags";

export const PRIVATE_SOURCE_ADAPTER_VERSION = "private_sources_v1" as const;
export const PRIVATE_SOURCE_REGISTRY = {
  everland: {
    sourceKey: "everland",
    sourceName: "에버랜드",
    sourceType: "organizer_official",
    venueType: "theme_park",
    allowedHosts: [
      "web.everland.com",
      "www.everland.com",
      "reservation.everland.com",
    ],
    enabled: true,
    adapterVersion: PRIVATE_SOURCE_ADAPTER_VERSION,
  },
} as const;

export type PrivateSourceKey = keyof typeof PRIVATE_SOURCE_REGISTRY;
export type CandidateEligibility = "eligible" | "not_eligible" | "needs_review";
export type DuplicateStatus =
  "new_candidate" | "probable_duplicate" | "ambiguous_duplicate";
export type CanonicalIdentityStability = "stable" | "fallback_unstable";
export type DateEvidenceClassification =
  "reliable_event_date" | "ambiguous_date" | "missing_date";

const PRODUCT_OR_PROMOTION =
  /(이용권|입장권|야간권|할인|쿠폰|멤버십|주차|레스토랑|식사|패키지|상품|굿즈|정기권|대여)/;
const EVENT_LANGUAGE =
  /(축제|페스티벌|쇼|공연|퍼레이드|체험|파티|이벤트|프로그램|콘서트)/;

export function classifyPrivateEligibility(input: {
  title: string;
  startDate: string | null;
  endDate: string | null;
  description: string;
}) {
  if (PRODUCT_OR_PROMOTION.test(input.title)) {
    return {
      eligibility: "not_eligible" as const,
      reason: "입장권·상품·할인·부대서비스 성격으로 실제 행사에서 제외",
    };
  }
  if (!input.startDate || !input.endDate) {
    return {
      eligibility: "needs_review" as const,
      reason: "행사명은 있으나 공식 페이지에서 완전한 운영기간을 추출하지 못함",
    };
  }
  if (!EVENT_LANGUAGE.test(`${input.title} ${input.description}`)) {
    return {
      eligibility: "needs_review" as const,
      reason: "기간은 있으나 독립 행사/프로그램인지 추가 검토 필요",
    };
  }
  return {
    eligibility: "eligible" as const,
    reason: "공식 페이지의 기간·행사명·방문 콘텐츠 확인",
  };
}

export type CandidateEvidence = {
  field: string;
  excerpt: string;
  sourceUrl: string;
};

export type DiscoveredEventCandidate = {
  sourceKey: PrivateSourceKey;
  sourceType: string;
  sourceUrl: string;
  canonicalSourceId: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  venueName: string | null;
  venueType: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  imageUrl: string | null;
  contactName: string | null;
  contactPhone: string | null;
  priceText: string | null;
  reservationUrl: string | null;
  fetchedAt: string;
  evidence: CandidateEvidence[];
  eligibility: CandidateEligibility;
  eligibilityReason: string;
  factTags: FactCandidate[];
  duplicateStatus: DuplicateStatus;
  parentCandidateId: string | null;
  subEventCandidate: boolean;
  lifecycle: "active" | "upcoming" | "ended" | "unknown";
};

export function isAllowedPrivateOfficialUrl(
  sourceKey: PrivateSourceKey,
  value: string,
) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      PRIVATE_SOURCE_REGISTRY[sourceKey].allowedHosts.includes(
        url.hostname as never,
      )
    );
  } catch {
    return false;
  }
}

export function normalizeTitle(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, "")
    .trim();
}

/**
 * Prefer an official item identifier when the source actually exposes one.
 * A URL path plus heading is only a discovery fallback: content headings can
 * change while the underlying organizer item remains the same.
 */
export function canonicalPrivateIdentity(input: {
  sourceKey: PrivateSourceKey;
  sourceUrl: string;
  title: string;
  officialItemId?: string | null;
}): { canonicalSourceId: string; stability: CanonicalIdentityStability } {
  const itemId = input.officialItemId?.trim();
  if (itemId) {
    return {
      canonicalSourceId: `${input.sourceKey}:item:${itemId}`,
      stability: "stable",
    };
  }
  const path = new URL(input.sourceUrl).pathname;
  return {
    canonicalSourceId: `${path}#${normalizeTitle(input.title).slice(0, 80) || "untitled"}`,
    stability: "fallback_unstable",
  };
}

export function classifyPrivateDateEvidence(input: {
  sourcePageType: string;
  startDate: string | null;
  endDate: string | null;
  completeDateRanges: Array<{ start: string; end: string }>;
}): { classification: DateEvidenceClassification; reason: string } {
  // A reservation product can expose a sale or valid-use range. It is never
  // enough to establish an event's operating period.
  if (input.sourcePageType === "official_reservation_product") {
    return {
      classification: "ambiguous_date",
      reason:
        "예약/상품 페이지의 판매·이용 가능 기간은 행사 운영기간으로 사용할 수 없음",
    };
  }
  if (input.completeDateRanges.length > 1) {
    return {
      classification: "ambiguous_date",
      reason: "복수의 비연속 운영기간을 단일 범위로 평탄화하면 안 됨",
    };
  }
  if (
    input.completeDateRanges.length === 1 &&
    input.startDate &&
    input.endDate
  ) {
    return {
      classification: "reliable_event_date",
      reason: "공식 행사 프로그램 페이지의 단일 완전 운영기간",
    };
  }
  if (input.sourcePageType === "official_season_program") {
    return {
      classification: "ambiguous_date",
      reason:
        "개별 프로그램의 완전한 시작·종료 기간이 페이지에서 확인되지 않음",
    };
  }
  return {
    classification: "missing_date",
    reason: "공식 페이지에서 행사 운영기간을 확인하지 못함",
  };
}

export function dateOverlap(
  left: Pick<DiscoveredEventCandidate, "startDate" | "endDate">,
  right: { startDate: string; endDate: string },
) {
  return Boolean(
    left.startDate &&
    left.endDate &&
    left.startDate <= right.endDate &&
    left.endDate >= right.startDate,
  );
}

export function classifyDuplicate(
  candidate: Pick<
    DiscoveredEventCandidate,
    "title" | "startDate" | "endDate" | "venueName" | "address" | "sourceUrl"
  >,
  existing: Array<{
    title: string;
    startDate: string;
    endDate: string;
    venue: string;
    address: string;
    sourceUrl?: string | null;
  }>,
): DuplicateStatus {
  const title = normalizeTitle(candidate.title);
  const exact = existing.find(
    (row) =>
      normalizeTitle(row.title) === title &&
      dateOverlap(candidate, {
        startDate: row.startDate,
        endDate: row.endDate,
      }) &&
      (candidate.venueName === row.venue || candidate.address === row.address),
  );
  if (exact) return "probable_duplicate";
  const titleMatch = existing.some(
    (row) =>
      normalizeTitle(row.title) === title &&
      dateOverlap(candidate, {
        startDate: row.startDate,
        endDate: row.endDate,
      }),
  );
  return titleMatch ? "ambiguous_duplicate" : "new_candidate";
}

export function classifyPrivateFacts(
  candidate: Pick<
    DiscoveredEventCandidate,
    "title" | "canonicalSourceId" | "sourceUrl" | "description"
  >,
  fetchedAt: string,
) {
  const documents: FactDocument[] = [
    {
      text: candidate.title,
      field: "title",
      source: candidate.sourceUrl,
      source_type: "organizer_official",
      checked_at: fetchedAt,
      scope: "event_level",
      strength: "direct_field",
    },
  ];
  if (candidate.description) {
    documents.push({
      text: candidate.description,
      field: "overview",
      source: candidate.sourceUrl,
      source_type: "organizer_official",
      checked_at: fetchedAt,
      scope: "event_level",
      strength: "direct_field",
    });
  }
  return classifyFactTags(
    { id: candidate.canonicalSourceId, title: candidate.title },
    documents,
  );
}
