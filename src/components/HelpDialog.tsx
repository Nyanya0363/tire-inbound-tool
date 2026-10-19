import { useEffect, useState } from 'react';
import type { Tutorial } from '../core/tutorials';

interface HelpDialogProps {
  open: boolean;
  tutorials: Tutorial[];
  onClose: () => void;
}

const TABS = [
  { id: 'flow', label: '使用流程' },
  { id: 'logic', label: '判断逻辑' },
  { id: 'status', label: '状态说明' },
  { id: 'faq', label: '常见问题' },
  { id: 'videos', label: '视频教程' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function HelpDialog({ open, tutorials, onClose }: HelpDialogProps) {
  const [tab, setTab] = useState<TabId>('flow');

  useEffect(() => {
    if (!open) return;
    setTab('flow');
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal help-modal"
        role="dialog"
        aria-modal="true"
        aria-label="帮助与教程"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>帮助与教程</h2>
            <p className="muted">这里把匹配逻辑、状态含义和常见问题都展开了。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="help-tabs">
          {TABS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={tab === item.id ? 'active' : ''}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="help-body">
          {tab === 'flow' && (
            <section className="help-section">
              <h3>正常使用只需要 4 步</h3>
              <ol className="help-steps">
                <li><strong>整理 Excel</strong>：只保留一行表头和本日需要入库的商品行，删除其他日期、其他品牌、合计、备注行。</li>
                <li><strong>上传文件</strong>：选择品牌，上传本日进库 Excel。</li>
                <li><strong>核对结果</strong>：可导入的直接通过；需确认的查看差异后确认；不可导入的检查商品资料。</li>
                <li><strong>下载模板</strong>：确认导出范围、数量和金额，再下载 .xlsx 或 .xls。</li>
              </ol>
              <div className="help-note">
                工具按“干净文件”设计，不做自动清洗。文件不符合要求时会被预检拦截。
              </div>
            </section>
          )}

          {tab === 'logic' && (
            <section className="help-section">
              <h3>程序不是直接比较整串型号</h3>
              <p>
                厂家型号和商品规格都会先拆成同一组字段，再按字段匹配。SKU 用于定位和导出，不会补齐缺失的型号字段；SKU 与商品规格冲突时会提示核对。空格、顺序可以归一化，XL、白字等标识会保留比较。
              </p>
              <div className="logic-fields">
                <span>品牌</span>
                <span>花纹</span>
                <span>规格</span>
                <span>层级</span>
                <span>载重速度</span>
                <span>标识</span>
              </div>
              <div className="help-example">
                <div><span>厂家</span><code>HAIDA 235/50ZR20 104W XL HD937</code></div>
                <div><span>拆成</span><code>海大 | HD937 | 235/50ZR20 | 104W | XL</code></div>
                <div><span>商品</span><code>H235/50ZR20 104W HD937 → 海大 | HD937 | 235/50ZR20 | 104W</code></div>
              </div>
              <h4>匹配顺序</h4>
              <ol className="help-steps">
                <li><strong>人工映射记忆</strong>：型号字段或原文命中，且商品规格、品牌、单位快照仍一致时复用；旧记忆或商品变化需要重新核对。</li>
                <li><strong>严格匹配</strong>：品牌、花纹、规格、层级、载重速度、标识全部一致。</li>
                <li><strong>核心匹配</strong>：品牌 + 花纹 + 规格 + 层级唯一命中，但描述有差异，标为“需确认”。</li>
                <li><strong>候选匹配</strong>：同花纹同规格有多个商品，或层级/载重速度不一致，不自动落库，交给人工选择。</li>
                <li><strong>花纹核对</strong>：基础花纹不同的商品直接排除。仅 EV 后缀不同可能是同款升级，需人工核对后保存；同花纹其他尺寸仅为辅助参考。疑似未建档需要人工核实后回系统新建。</li>
              </ol>
              <div className="help-note warn-note">
                关键原则：只有唯一命中才自动通过；模糊匹配只用于排序候选，不会自动确认。
              </div>
            </section>
          )}

          {tab === 'status' && (
            <section className="help-section">
              <h3>三类状态</h3>
              <div className="help-status-grid">
                <div className="help-status ok">
                  <strong>可导入</strong>
                  <p>严格匹配、映射记忆、人工选择，或核心匹配已确认的行。会写入导入模板。</p>
                </div>
                <div className="help-status mid">
                  <strong>需确认</strong>
                  <p>核心字段匹配但描述有差异，或存在多个候选。需要查看差异、确认或手动选择商品。</p>
                </div>
                <div className="help-status bad">
                  <strong>不可导入</strong>
                  <p>品牌未配置、型号无法解析，或商品资料里没有对应商品。不会写入导入模板。</p>
                </div>
              </div>
              <h4>差异怎么处理</h4>
              <ul className="help-list">
                <li>进入“需确认”后，会按差异原因分组，例如“缺少 XL”“缺少低滚阻”“缺少载重速度”。</li>
                <li>点分类只会筛选表格，不会直接确认。</li>
                <li>看完明细后，可以逐行确认，也可以确认本组可批量差异。</li>
                <li>EV 差异、规格、层级、载重速度不同需逐条核对；基础花纹不同不能对应。</li>
                <li>每条未解决行都需对应商品、标记待新建或明确本次跳过；改列映射后必须重新匹配。</li>
                <li>数量须为正整数、单价须大于 0。异常行请修正原表后重新上传，或明确跳过。</li>
                <li>撤销确认会删除同型号的相关记忆；映射管理中更改记忆后需重新匹配。</li>
              </ul>
            </section>
          )}

          {tab === 'faq' && (
            <section className="help-section">
              <h3>常见问题</h3>
              <details>
                <summary>为什么文件被拦截了？</summary>
                <p>常见原因：文件里有多个日期区块、还有其他品牌、型号列或数量列没有识别到。按页面红色提示清理文件后重新上传。</p>
              </details>
              <details>
                <summary>为什么商品资料里找不到？</summary>
                <p>“疑似未建档”需要先人工核对型号和候选商品。确认是新品后，回业务系统新建商品，再在本工具“维护商品目录”中更新资料并重新匹配。仅更新本工具目录不会在业务系统创建商品。</p>
              </details>
              <details>
                <summary>单价按底价还是价格？</summary>
                <p>页面可以直接选择“底价”或“价格”。导出确认弹窗会显示当前使用的单价口径，金额也会按这个口径计算。</p>
              </details>
              <details>
                <summary>为什么有些行显示“品牌未配置”？</summary>
                <p>当前供应商为四川海大轮胎橡胶集团股份有限公司，支持海大、天府混合导入。其他品牌需要先删除对应行。</p>
              </details>
              <details>
                <summary>人工确认过的映射存在哪里？</summary>
                <p>默认存在当前浏览器里。可以在页面底部的“映射记忆管理”查看、删除、导出和导入。</p>
              </details>
              <details>
                <summary>更新商品目录后什么时候生效？</summary>
                <p>生成 catalog.json 后替换 public/catalog.json 并提交，重新部署后所有使用者生效。页面里的“临时应用”只影响当前页面。</p>
              </details>
            </section>
          )}

          {tab === 'videos' && (
            <section className="help-section">
              <h3>视频教程</h3>
              {tutorials.length === 0 ? (
                <div className="help-note">
                  还没有视频教程。管理员可以在页面底部的“教程视频管理”里添加链接。
                </div>
              ) : (
                <div className="tutorial-list">
                  {tutorials.map((tutorial) => (
                    <article className="tutorial-card" key={tutorial.id}>
                      <div className="tutorial-head">
                        <div>
                          <h4>{tutorial.title}</h4>
                          {tutorial.description && <p>{tutorial.description}</p>}
                        </div>
                        <span className="version-pill">
                          {tutorial.type === 'video' ? '视频' : '链接'}
                        </span>
                      </div>
                      {tutorial.type === 'video' ? (
                        <video controls preload="metadata" src={tutorial.url} />
                      ) : (
                        <a href={tutorial.url} target="_blank" rel="noreferrer" className="tutorial-link">
                          打开视频教程 ↗
                        </a>
                      )}
                    </article>
                  ))}
                </div>
              )}
              <div className="help-note">
                视频文件建议放在 B 站、GitHub Release 或云存储，再填写链接；不要直接把大视频提交到 GitHub Pages。
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
