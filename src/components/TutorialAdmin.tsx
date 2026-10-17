import { useState } from 'react';
import type { Tutorial, TutorialType } from '../core/tutorials';
import { downloadTutorials, isVideoUrl } from '../core/tutorials';

interface TutorialAdminProps {
  tutorials: Tutorial[];
  onChange: (next: Tutorial[]) => void;
}

export function TutorialAdmin({ tutorials, onChange }: TutorialAdminProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<'auto' | TutorialType>('auto');
  const [message, setMessage] = useState('');

  function handleAdd() {
    const trimmedTitle = title.trim();
    const trimmedUrl = url.trim();
    if (!trimmedTitle || !trimmedUrl) {
      setMessage('标题和视频地址必填');
      return;
    }
    const resolvedType: TutorialType =
      type === 'auto' ? (isVideoUrl(trimmedUrl) ? 'video' : 'link') : type;
    if (resolvedType === 'video' && !isVideoUrl(trimmedUrl) && !trimmedUrl.startsWith('blob:')) {
      setMessage('选择了“视频”，但地址不像 mp4/webm/ogg 文件。请改用“链接”类型。');
      return;
    }
    onChange([
      ...tutorials,
      {
        id: `tutorial-${Date.now()}`,
        title: trimmedTitle,
        description: description.trim() || undefined,
        url: trimmedUrl,
        type: resolvedType,
      },
    ]);
    setTitle('');
    setDescription('');
    setUrl('');
    setType('auto');
    setMessage('已添加到当前页面，下载 tutorials.json 后提交即可对外生效');
  }

  function handleDelete(id: string) {
    onChange(tutorials.filter((tutorial) => tutorial.id !== id));
    setMessage('已删除');
  }

  return (
    <details className="card admin-card">
      <summary>
        <span>
          <strong>教程视频管理</strong>
          <span className="summary-sub">维护帮助页里的视频教程</span>
        </span>
        <span className="version-pill">{tutorials.length} 个视频</span>
      </summary>
      <div className="admin-body">
        <div className="help-note">
          静态网页不能直接保存视频文件。请先把视频上传到 B 站、GitHub Release 或云存储，再把链接填到这里。
          如果视频放在项目的 <code>public/tutorials/</code> 下，地址填 <code>tutorials/文件名.mp4</code>。
        </div>

        <div className="tutorial-form">
          <div className="field">
            <label>标题 *</label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：入库工具快速上手"
            />
          </div>
          <div className="field">
            <label>说明</label>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="一句话说明这个视频讲什么"
            />
          </div>
          <div className="field">
            <label>视频地址 *</label>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://... 或 tutorials/xxx.mp4"
            />
          </div>
          <div className="field">
            <label>类型</label>
            <select value={type} onChange={(event) => setType(event.target.value as 'auto' | TutorialType)}>
              <option value="auto">自动判断</option>
              <option value="video">直接播放的视频文件</option>
              <option value="link">外部链接（B 站等）</option>
            </select>
          </div>
          <button type="button" className="primary" onClick={handleAdd}>
            添加教程
          </button>
        </div>

        {message && <div className="alert success">{message}</div>}

        {tutorials.length > 0 ? (
          <div className="tutorial-admin-list">
            {tutorials.map((tutorial) => (
              <div className="tutorial-admin-row" key={tutorial.id}>
                <div>
                  <strong>{tutorial.title}</strong>
                  <span>{tutorial.url}</span>
                </div>
                <div className="tutorial-admin-actions">
                  <a href={tutorial.url} target="_blank" rel="noreferrer" className="link-button">
                    预览
                  </a>
                  <button
                    type="button"
                    className="link-button muted-link"
                    onClick={() => handleDelete(tutorial.id)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty">还没有添加教程视频</p>
        )}

        <div className="admin-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => downloadTutorials(tutorials)}
            disabled={tutorials.length === 0}
          >
            下载 tutorials.json
          </button>
        </div>
        <p className="hint">
          下载后替换项目里的 <code>public/tutorials.json</code>，提交到 GitHub。页面重新部署后，所有使用者都能在“帮助与教程 → 视频教程”里看到。
        </p>
      </div>
    </details>
  );
}
