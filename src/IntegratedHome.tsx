import './integrated-home.css';

const services = [
  { number: '01', category: '상품 발굴', title: '도매상품 수익 발굴기', description: '판매할 상품을 찾고 수익 가능성을 살펴보는 공간입니다.', tags: ['상품 탐색', '수익 검토'] },
  { number: '02', category: '콘텐츠 제작', title: 'AI 상세페이지 연구소', description: '상품의 매력을 전하는 상세페이지를 준비하는 공간입니다.', tags: ['상품 콘텐츠', '상세페이지'] },
];

export default function IntegratedHome() {
  return <div className="platform">
    <header className="platform-header"><a className="platform-logo" href="/platform-preview">GALTEUM<span>.</span></a><a className="platform-events" href="/">주말 행사 찾기 <span aria-hidden="true">↗</span></a></header>
    <main>
      <section className="platform-hero"><div className="platform-hero-inner"><p className="platform-kicker">GALTEUM FOR YOUR WORK</p><h1>좋은 아이디어가<br/><em>일이 되는 틈.</em></h1><p className="platform-intro">상품을 발견하는 순간부터 콘텐츠를 준비하는 일까지.<br/>갈틈에서 더 나은 일의 방식을 만들어갑니다.</p><a className="platform-anchor" href="#services">서비스 둘러보기 <span aria-hidden="true">↓</span></a></div><div className="platform-art" aria-hidden="true"><span>G</span><i></i><b>MAKE<br/>ROOM<br/>FOR IDEAS.</b></div></section>
      <section className="platform-services" id="services"><div className="platform-section-head"><div><p className="platform-kicker">OUR SERVICES</p><h2>당신의 일을 위한 도구</h2></div><p>필요한 순간에, 필요한 도구를.<br/>갈틈의 서비스가 하나씩 찾아갑니다.</p></div><div className="platform-grid">{services.map(service => <article className="platform-card" key={service.number}><div className="platform-card-top"><span>{service.number} / {service.category}</span><span className="platform-status">준비 중</span></div><div className="platform-card-body"><h3>{service.title}</h3><p>{service.description}</p></div><div className="platform-card-bottom"><div>{service.tags.map(tag => <span key={tag}>{tag}</span>)}</div></div></article>)}</div></section>
      <section className="platform-closing"><p className="platform-kicker">MORE TO COME</p><h2>더 많은 가능성을 준비하고 있어요.</h2><p>새로운 서비스가 준비되면 이곳에서 소개할게요.</p></section>
    </main><footer className="platform-footer"><strong>GALTEUM<span>.</span></strong><p>일상과 일 사이, 새로운 가능성을 발견하는 곳.</p><small>© GALTEUM</small></footer>
  </div>;
}
