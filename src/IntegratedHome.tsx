import { useEffect } from 'react';
import { ArrowDownRight, ArrowUpRight, Layers3, Search } from 'lucide-react';
import './integrated-home.css';

const services = [
  {
    id: '01',
    category: 'PRODUCT DISCOVERY',
    title: '도매상품 수익 발굴기',
    description: '도매상품을 찾고 경쟁가격과 예상 수익을 비교해, 판매할 상품을 판단하는 도구.',
    features: ['도매상품 검색', '경쟁가격 비교', '예상 수익 분석'],
    icon: Search,
    href: 'https://wholesale.galteum.com/wholesale/',
  },
  {
    id: '02',
    category: 'CONTENT STUDIO',
    title: 'AI 상세페이지 연구소',
    description: '상품 자료를 정리하고 판매에 필요한 상세페이지 콘텐츠를 제작하는 도구.',
    features: ['상품 정보 구성', '이미지·문구 제작', '상세페이지 구성'],
    icon: Layers3,
    href: null,
  },
] as const;

export default function IntegratedHome() {
  useEffect(() => {
    const oldTitle = document.title;
    const metaDescription = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const oldDescription = metaDescription?.content;
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const oldThemeColor = themeColor?.content;

    document.title = 'GALTEUM | 비즈니스를 위한 디지털 도구';
    if (metaDescription) {
      metaDescription.content = '도매상품 발굴부터 상세페이지 제작까지. 비즈니스에 필요한 디지털 도구를 한곳에서 준비합니다.';
    }
    if (themeColor) themeColor.content = '#0b0d10';

    return () => {
      document.title = oldTitle;
      if (metaDescription && oldDescription !== undefined) metaDescription.content = oldDescription;
      if (themeColor && oldThemeColor !== undefined) themeColor.content = oldThemeColor;
    };
  }, []);

  return (
    <div className="platform" id="top">
      <header className="platform-header">
        <a className="platform-brand" href="#top" aria-label="GALTEUM 홈">
          GALTEUM<span className="platform-brand-dot">.</span>
        </a>
        <span className="platform-header-center">TOOLS FOR THE WAY YOU WORK</span>
        <a className="platform-header-link" href="#services">
          서비스 보기 <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </header>

      <main>
        <section className="platform-hero" aria-labelledby="platform-hero-title">
          <div className="platform-hero-grid">
            <div className="platform-hero-copy">
              <p className="platform-eyebrow"><span className="platform-live-dot" /> GALTEUM / DIGITAL WORKSPACE</p>
              <h1 id="platform-hero-title">상품 발굴부터,<br /><span>상세페이지까지.</span></h1>
              <p className="platform-hero-description">
                상품을 발굴하는 일부터 상세페이지를 제작하는 일까지.<br className="platform-desktop-break" />
                반복되는 업무를 줄이는 서비스를 하나씩 만들고 있습니다.
              </p>
              <a className="platform-hero-action" href="#services">
                서비스 살펴보기 <ArrowDownRight size={19} aria-hidden="true" />
              </a>
              <div className="platform-hero-progress">
                <span className="platform-progress-line" /> 이용 가능 01 · 준비 중 01
              </div>
            </div>

            <div className="platform-visual" aria-hidden="true">
              <div className="platform-visual-head"><span>WORKSPACE / 00</span><span>PRIVATE WORKSPACE</span></div>
              <div className="platform-visual-core">
                <div className="platform-orbit platform-orbit-one" />
                <div className="platform-orbit platform-orbit-two" />
                <div className="platform-visual-mark">G<span>.</span></div>
                <span className="platform-visual-coord platform-visual-coord-one">01 / FIND</span>
                <span className="platform-visual-coord platform-visual-coord-two">02 / CREATE</span>
              </div>
              <div className="platform-visual-bottom">
                <span>BUILDING BETTER WORKFLOWS</span>
                <span className="platform-visual-dashes"><i /><i /><i /><i /></span>
              </div>
            </div>
          </div>
        </section>

        <section className="platform-services" id="services" aria-labelledby="platform-services-heading">
          <div className="platform-section-heading">
            <div>
              <p className="platform-section-kicker">01 / OUR SERVICES</p>
              <h2 id="platform-services-heading">필요한 일을,<br /><span>더 단순하게.</span></h2>
            </div>
            <p className="platform-section-lead">도매상품 발굴기는 승인된 계정으로 이용할 수 있습니다.<br />상세페이지 연구소는 준비 중입니다.</p>
          </div>

          <div className="platform-service-grid">
            {services.map((service) => {
              const ServiceIcon = service.icon;
              return (
                <article className="platform-service-card" key={service.id}>
                  <div className="platform-service-top">
                    <span className="platform-service-number">{service.id} <span>/ {service.category}</span></span>
                    <span className="platform-service-status"><span /> {service.href ? "이용 가능 · 로그인 필요" : "준비 중"}</span>
                  </div>
                  <div className="platform-service-icon"><ServiceIcon size={27} strokeWidth={1.6} aria-hidden="true" /></div>
                  <h3>{service.title}</h3>
                  <p className="platform-service-description">{service.description}</p>
                  <div className="platform-service-features" aria-label={service.href ? "제공 기능" : "예정 기능"}>
                    <span className="platform-feature-label">{service.href ? "제공 기능" : "예정 기능"}</span>
                    <div>{service.features.map((feature) => <span key={feature}>{feature}</span>)}</div>
                  </div>
                  {service.href && (
                    <a className="platform-service-action" href={service.href}>
                      도매상품 발굴기 이용하기 <ArrowUpRight size={17} aria-hidden="true" />
                    </a>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section className="platform-note" aria-labelledby="platform-note-heading">
          <div>
            <p className="platform-section-kicker">02 / WHAT'S NEXT</p>
            <h2 id="platform-note-heading">도구는 하나씩.<br />기준은 분명하게.</h2>
          </div>
          <p>도매상품 발굴기는 로그인 후 이용할 수 있습니다.<br />새로운 도구는 준비가 완료되면 연결합니다.</p>
        </section>
      </main>

      <footer className="platform-footer">
        <span className="platform-footer-brand">GALTEUM<span>.</span></span>
        <span className="platform-footer-description">DIGITAL TOOLS FOR BUSINESS</span>
        <small>© 2026 GALTEUM</small>
      </footer>
    </div>
  );
}
