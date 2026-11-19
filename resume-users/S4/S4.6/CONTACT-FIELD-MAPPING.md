# Contact 映射

旧 CMS `ContactSection` 与 Users S3.2 的 Contact 业务域相对应。两种语言共用条目身份，按内容语言编辑标题和详情。现有账户身份与 Profile 草稿继续使用原有入口。

| 旧 CMS 字段 | 本地草稿 | 未来 S3.2 合同 |
| --- | --- | --- |
| `translations[locale].contactLabel`、`availability` | 同名双语字段。前者是 Contact 栏目标题，后者是可联系文案。 | `contact_translations.contact_label`、`availability` |
| `focus[].id`、`position` | 稳定临时 `clientId` 与归零连续的 `position`。 | `contact_focus_items` |
| `focus[].translations[locale].title/detail` | 每个子条目的双语标题和详情。 | `contact_focus_translations` |
| `status[].id`、`position`、`statusType` | 独立临时 ID 和排序，类别是共享的 `study`、`graduation`、`open`。新条目默认为 `open`。 | `contact_status_items.status_type` 和同站独立顺序 |
| `status[].translations[locale].title/detail` | 每条状态的双语标题和详情。 | `contact_status_translations` |

Focus 和 Status 各自维护增删与顺序，分别确认删除。取消联系栏修改会清空该模块的新建本地草稿。预览按当前内容语言投射非空条目，读取 Profile 的 `contactFocusHeading` 和 `contactStatusHeading`，在存在条目而对应标题为空时使用预览默认文案。Contact 自身的栏目标题与公开导航标签各自编辑。
