import { Button } from "unlikely-ui/button";
import { Popover } from "unlikely-ui/popover";
import { Icon } from "./ui";

export function Help() {
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button variant="ghost" size="icon" aria-label="Как это работает" />
        }
      >
        <svg
          className="icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4m0 3h.01" />
        </svg>
      </Popover.Trigger>
      <Popover.Content
        className="help-popover"
        positionerProps={{ align: "end", collisionPadding: 12 }}
      >
        <div className="help-heading">
          <Popover.Title>Как это работает</Popover.Title>
          <Popover.Close
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Закрыть справку"
              />
            }
          >
            <Icon name="close" />
          </Popover.Close>
        </div>
        <Popover.Description>
          Предложения публикуются после проверки. Сообщения об ошибках видит
          только администратор. Регистрация не нужна.
        </Popover.Description>
        <p>
          Поддержите нужное предложение. Повторное нажатие отменяет ваш голос.
        </p>
        <details>
          <summary>Голосование и приватность</summary>
          <p>
            Голос связан с cookie этого браузера на 365 дней. После отмены его
            можно вернуть. В общей сети новый голос за то же предложение может
            задержаться на 60 секунд. Сброс cookie не гарантирует обход
            ограничений; голоса не равны числу людей.
          </p>
        </details>
        <a className="help-admin" href="/admin">
          <Icon name="lock" />
          Для администратора
        </a>
      </Popover.Content>
    </Popover.Root>
  );
}
