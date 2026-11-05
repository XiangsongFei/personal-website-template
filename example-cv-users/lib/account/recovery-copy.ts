// Fixed messages shared by the server and browser. Never display Auth error text.
import { GRANT_SECONDS, OTP_SECONDS, RESEND_SECONDS } from './policy';

export const AUTH_COPY = {
    invalidCredentials: '账号或密码不正确，请重新输入。',
    network: '暂时无法连接，请稍后重试。',
    limited: '操作太频繁，请稍后再试。',
} as const;
export const RECOVERY_COPY = {
    guidance: `请在发起申请的浏览器完成。六位验证码自签发起 ${OTP_SECONDS / 60} 分钟内有效。未收到可检查垃圾邮件，至少 ${RESEND_SECONDS} 秒后再申请。重新申请可能使之前的验证码失效，邮件到达顺序不能判断哪个码有效。`,
    passwordWindow: `请在验证码验证通过后 ${GRANT_SECONDS / 60} 分钟内设置新密码。`,
    invalid: '验证码无效或已过期，请检查后重试，或重新获取。',
    restart: '本次操作已失效，请重新开始。',
    limited: AUTH_COPY.limited,
    sendUnknown: `无法确认是否已发出邮件。请先检查收件箱和垃圾邮件，至少 ${RESEND_SECONDS} 秒后再手动申请。`,
    verifyUnknown: '未能确认本次验证。请重新开始恢复，不会自动发码。',
    active: '此浏览器已有恢复流程。请继续设置新密码；如本次操作已失效，请重新开始。',
    rejected: '密码没有更新。请重新获取验证码，再设置一个符合规则且不同于原密码的新密码。',
    updateUnknown: '暂时无法确认密码是否已更新，请先尝试使用新密码登录，避免重复修改。',
    updated: '密码已修改，请使用新密码登录。',
    logoutUnknown: '密码已更新，但退出状态未确认。请重新登录核对。',
} as const;
