#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

void win(void) {
    const char *f = getenv("FLAG");
    puts(f ? f : "PAD{placeholder}");
    fflush(stdout);
    _exit(0);
}

void vuln(void) {
    char buf[64];
    printf("Nom ? ");
    fflush(stdout);
    gets(buf); /* volontairement vulnérable */
    printf("Salut %s\n", buf);
}

int main(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    vuln();
    return 0;
}
