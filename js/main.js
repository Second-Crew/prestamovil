/**
 * Prestamovil — Main JS
 * Nav toggle, smooth scroll, FAQ accordion, scroll animations
 */
(function () {
  'use strict';

  /* ── Nav: hamburger toggle ── */
  var toggle = document.querySelector('.nav__toggle');
  var navLinks = document.querySelector('.nav__links');

  if (toggle && navLinks) {
    toggle.addEventListener('click', function () {
      toggle.classList.toggle('active');
      navLinks.classList.toggle('open');
    });

    /* Close menu when a link is clicked (mobile) */
    var links = navLinks.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function () {
        toggle.classList.remove('active');
        navLinks.classList.remove('open');
      });
    }
  }

  /* ── Nav: scroll effect ── */
  var nav = document.querySelector('.nav');
  if (nav) {
    window.addEventListener('scroll', function () {
      if (window.scrollY > 50) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
    });
  }

  /* ── Smooth scroll for anchor links ── */
  var anchors = document.querySelectorAll('a[href^="#"]');
  for (var j = 0; j < anchors.length; j++) {
    anchors[j].addEventListener('click', function (e) {
      var href = this.getAttribute('href');
      if (href.length < 2) return;
      var target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  /* ── FAQ accordion ── */
  var faqQuestions = document.querySelectorAll('.faq-item__question');
  for (var k = 0; k < faqQuestions.length; k++) {
    faqQuestions[k].addEventListener('click', function () {
      var item = this.parentElement;
      var isOpen = item.classList.contains('active');

      /* Close all siblings */
      var siblings = item.parentElement.querySelectorAll('.faq-item');
      for (var s = 0; s < siblings.length; s++) {
        siblings[s].classList.remove('active');
      }

      /* Toggle the clicked one */
      if (!isOpen) {
        item.classList.add('active');
      }
    });
  }

  /* ── Scroll-triggered animations (IntersectionObserver) ── */
  var animatedEls = document.querySelectorAll('.animate-on-scroll');

  if (animatedEls.length && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        for (var e = 0; e < entries.length; e++) {
          if (entries[e].isIntersecting) {
            entries[e].target.classList.add('visible');
            observer.unobserve(entries[e].target);
          }
        }
      },
      { threshold: 0.15 }
    );

    for (var m = 0; m < animatedEls.length; m++) {
      observer.observe(animatedEls[m]);
    }
  } else {
    /* Fallback: show everything */
    for (var n = 0; n < animatedEls.length; n++) {
      animatedEls[n].classList.add('visible');
    }
  }

  /* ── Active nav link highlight ── */
  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  var navAnchors = document.querySelectorAll('.nav__links a');
  for (var p = 0; p < navAnchors.length; p++) {
    var linkHref = navAnchors[p].getAttribute('href');
    if (linkHref === currentPage) {
      navAnchors[p].classList.add('active');
    }
  }

})();
